import { supabase } from '@/plugins/supabase'

const supabaseLookupsRepository = {
  async listDocumentTypes() {
    const { data, error } = await supabase
      .from('document_types')
      .select('code, label')
      .order('label', { ascending: true })
    if (error) throw error
    return data || []
  },

  async listDepartments() {
    const { data, error } = await supabase
      .from('departments')
      .select('department_id, code, name')
      .order('name', { ascending: true })
    if (error) throw error
    return data || []
  },

  async listCities(departmentId = null) {
    let query = supabase.from('cities').select('city_id, department_id, name')
    if (departmentId) query = query.eq('department_id', departmentId)
    const { data, error } = await query.order('name', { ascending: true })
    if (error) throw error
    return data || []
  },
}

export default supabaseLookupsRepository
