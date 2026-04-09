import { supabase } from '@/plugins/supabase'

const lookupsService = {
  async listDocumentTypes() {
    const { data, error } = await supabase.from('document_types').select('code, label').order('label', { ascending: true })
    if (error) throw error
    return data || []
  },

  async listDepartments() {
    const { data, error } = await supabase.from('departments').select('department_id, code, name').order('name', { ascending: true })
    if (error) throw error
    return data || []
  },

  async listCities(department_id = null) {
    let q = supabase.from('cities').select('city_id, department_id, name')
    if (department_id) q = q.eq('department_id', department_id)
    const { data, error } = await q.order('name', { ascending: true })
    if (error) throw error
    return data || []
  }
}

export default lookupsService
