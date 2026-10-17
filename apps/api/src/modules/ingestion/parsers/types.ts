/** One parser output block: text plus the structure the format gave us. */
export interface RawBlock {
  text: string;
  /** Closest heading above this block (DOCX/Markdown); PDFs carry none. */
  heading?: string | undefined;
  /** 1-based source page (PDF only). */
  page?: number | undefined;
}
