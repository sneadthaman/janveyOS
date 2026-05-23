export const ACTION_TYPE_QUOTE_TO_SO = "quote_to_so";
export const ACTION_TYPE_ETA_UPDATE = "eta_update";
export const ACTION_TYPE_NEW_ITEM_DRAFT = "new_item_draft";
export const ACTION_TYPE_PO_ACK = "po_ack";

export const ACTION_TYPES = [
  ACTION_TYPE_QUOTE_TO_SO,
  ACTION_TYPE_ETA_UPDATE,
  ACTION_TYPE_NEW_ITEM_DRAFT,
  ACTION_TYPE_PO_ACK
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export function normalizeActionType(actionType: string) {
  if (["quote_to_so", "quote_to_so_preview", "quote_to_sales_order", "estimate_to_sales_order"].includes(actionType)) {
    return ACTION_TYPE_QUOTE_TO_SO;
  }
  return actionType;
}
