import type { ApiError } from '@citizenrun/shared';
import type {
  CreateClientErrorMutationError,
  GetHealthzQueryError,
  GetOpenApiDocumentQueryError,
  GetReadyzQueryError,
} from '@citizenrun/shared/api';
import { describe, expectTypeOf, it } from 'vitest';

// apiFetch throws ApiError for every status that is not 2xx, so a hook's error is that class and
// never the response body (01 section 7.1, D-821). The assertions are checked by the type check.
describe('the generated hooks', () => {
  it('type their error as ApiError', () => {
    expectTypeOf<GetReadyzQueryError>().toEqualTypeOf<ApiError>();
    expectTypeOf<GetHealthzQueryError>().toEqualTypeOf<ApiError>();
    expectTypeOf<GetOpenApiDocumentQueryError>().toEqualTypeOf<ApiError>();
    expectTypeOf<CreateClientErrorMutationError>().toEqualTypeOf<ApiError>();
  });
});
