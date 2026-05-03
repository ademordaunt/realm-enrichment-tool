export interface HubSpotPushDonePayload {
  created: number;
  updated: number;
  errors: { rowId: string; error: string }[];
  listId: string;
  listName: string;
  totalPushed: number;
  /** HubSpot list folder id when the list was created inside a folder. */
  folderId?: string;
  /** Number of companies matched by name only (no domain). These should be verified in HubSpot. */
  nameMatchedCount?: number;
  /** Contacts successfully linked to a HubSpot company via domain lookup. */
  contactsAssociated?: number;
  /** Contacts where company domain was present but no matching HubSpot company was found. */
  contactsDomainNotFound?: number;
  /** Contacts where no company domain was available for lookup. */
  contactsNoDomain?: number;
  /** Company records with no state/region — may not receive automatic owner assignment. */
  companiesNoState?: number;
  /** Contacts with no HubSpot company association — may not receive automatic owner assignment. */
  contactsNoCompanyAssociation?: number;
}
