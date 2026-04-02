export interface Notebook {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
}

export interface Folder {
  id: string;
  notebookId: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  folderId: string | null;
  notebookId: string;
  title: string;
  body: string;
  drawingAssetId: string | null;
  isDirty: number;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
}
