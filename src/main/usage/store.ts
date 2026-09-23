import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageConnection, UsageCredential, UsageSnapshot } from '../../shared/usage';
import { validateConnection, parseCredential } from './config';
import { UsageError } from './errors';
export type SecretCodec = {
    available(): boolean;
    encrypt(value: string): Buffer;
    decrypt(value: Buffer): string;
};
export class UsageStore {
    connections: UsageConnection[] = [];
    snapshots: Record<string, UsageSnapshot> = {};
    private secrets: Record<string, UsageCredential> = {};
    private writes: Promise<void> = Promise.resolve();
    constructor(private root: string, private codec: SecretCodec) { }
    async load(): Promise<void> {
        try {
            const raw = JSON.parse(await readFile(join(this.root, 'state.json'), 'utf8'));
            if (raw.schemaVersion !== 1 || !Array.isArray(raw.connections))
                throw new Error();
            this.connections = raw.connections.map(validateConnection);
            if (raw.secrets) {
                if (!this.codec.available())
                    throw new UsageError('encryption', '无法解密凭据；请使用原 Windows 用户 / Credentials cannot be decrypted');
                const decrypted = JSON.parse(this.codec.decrypt(Buffer.from(raw.secrets, 'base64')));
                for (const c of this.connections)
                    this.secrets[c.id] = parseCredential(decrypted[c.id]);
            }
            this.snapshots = raw.snapshots && typeof raw.snapshots === 'object' ? raw.snapshots : {};
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return;
            throw new UsageError('storage', '用量配置无法读取，已停止写入以保护数据 / Usage storage unavailable; original data preserved');
        }
    }
    credential(id: string): UsageCredential { return { ...this.secrets[id] }; }
    setCredential(id: string, credential: UsageCredential): void { this.secrets[id] = { ...credential }; }
    delete(id: string): void { this.connections = this.connections.filter(c => c.id !== id); delete this.secrets[id]; delete this.snapshots[id]; }
    async save(): Promise<void> {
        if (!this.codec.available() && Object.values(this.secrets).some(c => Object.keys(c).length))
            throw new UsageError('encryption', '系统加密不可用，凭据未保存 / System encryption unavailable');
        const hasSecrets = Object.values(this.secrets).some(c => Object.keys(c).length);
        const payload = JSON.stringify({ schemaVersion: 1, connections: this.connections, snapshots: this.snapshots,
            secrets: hasSecrets ? this.codec.encrypt(JSON.stringify(this.secrets)).toString('base64') : undefined });
        const write = this.writes.catch(() => { }).then(async () => {
            await mkdir(this.root, { recursive: true });
            const temp = join(this.root, 'state.json.tmp');
            await writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 });
            await rename(temp, join(this.root, 'state.json'));
        });
        this.writes = write;
        return write;
    }
    flush(): Promise<void> { return this.writes; }
}
