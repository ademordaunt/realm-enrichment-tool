export interface HubSpotPushDonePayload {
  created: number;
  updated: number;
  errors: { rowId: string; error: string }[];
  listId: string;
  listName: string;
  totalPushed: number;
  /** HubSpot list folder id when the list was created inside a folder. */
  folderId?: string;
}
