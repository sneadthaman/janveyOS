import { normalizeActionType } from "./action-types.js";

export function actionHandlerName(actionType: string) {
  return `handler_${normalizeActionType(actionType)}`;
}
