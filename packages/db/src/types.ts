export interface Notebook {
  id: string;
  name: string;
  isDirty: number;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
  sortOrder: number;
}

export interface Folder {
  id: string;
  notebookId: string;
  parentId: string | null;
  name: string;
  isDirty: number;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
  sortOrder: number;
}

export interface Note {
  id: string;
  folderId: string | null;
  notebookId: string;
  title: string;
  body: string;
  drawingAssetId: string | null;
  canvasJson: string | null;
  graphiteBlob: Uint8Array | null;
  canvasVersion: number;
  ftsBody: string | null;
  isDirty: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
}
