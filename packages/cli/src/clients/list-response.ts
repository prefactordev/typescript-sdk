export interface PaginationOutput {
  item_count: number;
  item_end: number;
  item_start: number;
  next_page_offset: number | null;
  page_count: number;
  page_index: number;
  page_offset: number;
  page_size: number;
  previous_page_offset: number | null;
}

export interface Sorting {
  direction?: 'asc' | 'desc';
  field?: string;
  nulls?: 'first' | 'last' | 'auto';
}

export interface ListResponse<T> {
  pagination: PaginationOutput | null;
  sorting: Sorting | null;
  status: 'success';
  summaries: T[];
}
