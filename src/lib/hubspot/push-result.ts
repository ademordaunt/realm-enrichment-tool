export interface HubSpotPushDonePayload {
  created: number;
  updated: number;
  errors: { rowId: string; error: string }[];
  listId: string;
  listName: string;
  totalPushed: number;
}
