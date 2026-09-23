import type { MenuItemConstructorOptions } from 'electron';
import type { I18nKey } from '../../shared/i18n';
type AiAction = {
    id: string;
    label: I18nKey;
    run(): void;
};
export function buildAiMenuItems(actions: AiAction[], translate: (key: I18nKey) => string): MenuItemConstructorOptions[] {
    return actions.map(action => ({ id: action.id, label: translate(action.label), click: action.run }));
}
