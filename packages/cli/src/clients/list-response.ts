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

export interface ListQueryParams {
  sorting?: {
    field: string;
    direction?: 'asc' | 'desc';
  };
  pagination?: {
    offset?: number;
    page_size?: number;
  };
}

/** Query keys for list sorting and pagination, using the API's bracket form. */
export function listQuery(params: ListQueryParams): Record<string, string | number> {
  return {
    ...(params.sorting
      ? {
          'sorting[field]': params.sorting.field,
          'sorting[direction]': params.sorting.direction ?? 'asc',
        }
      : {}),
    ...(params.pagination?.offset !== undefined
      ? { 'pagination[offset]': params.pagination.offset }
      : {}),
    ...(params.pagination?.page_size !== undefined
      ? { 'pagination[page_size]': params.pagination.page_size }
      : {}),
  };
}
