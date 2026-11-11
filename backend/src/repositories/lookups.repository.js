import { supabaseRestGet } from './supabaseRestClient.js';

export function createLookupsRepository(deps) {
  return {
    listDocumentTypes() {
      return supabaseRestGet('/document_types?select=code,label&order=label.asc', {
        ...deps,
        domain: 'lookups',
        operation: 'listDocumentTypes',
      });
    },

    listDepartments() {
      return supabaseRestGet('/departments?select=department_id,code,name&order=name.asc', {
        ...deps,
        domain: 'lookups',
        operation: 'listDepartments',
      });
    },

    listCities(departmentId = null) {
      const filter = departmentId ? `&department_id=eq.${encodeURIComponent(departmentId)}` : '';
      return supabaseRestGet(`/cities?select=city_id,department_id,name${filter}&order=name.asc`, {
        ...deps,
        domain: 'lookups',
        operation: 'listCities',
      });
    },
  };
}

