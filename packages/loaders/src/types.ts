export interface Document {
  content: string;
  metadata: Record<string, unknown>;
  source: string;
}

export abstract class DocumentLoader {
  /** Load documents from the given source path */
  abstract load(source: string): Promise<Document[]>;

  /** Returns true if this loader can handle the given file extension */
  abstract supports(extension: string): boolean;
}
