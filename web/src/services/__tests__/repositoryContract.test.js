import { describe, expect, it, vi } from 'vitest'

import { createLookupsRepositoryAdapter } from '../../../../shared/contracts/lookupsRepository.js'

describe('repository contracts', () => {
  it('valida metodos requeridos del repositorio', () => {
    expect(() => createLookupsRepositoryAdapter({
      fallback: {
        listDocumentTypes: vi.fn(),
        listDepartments: vi.fn(),
      },
    })).toThrow(/listCities/)
  })

  it('usa fallback cuando el backend no esta habilitado', async () => {
    const primary = {
      listDocumentTypes: vi.fn(async () => [{ code: 'CC' }]),
      listDepartments: vi.fn(async () => []),
      listCities: vi.fn(async () => []),
    }
    const fallback = {
      listDocumentTypes: vi.fn(async () => [{ code: 'NIT' }]),
      listDepartments: vi.fn(async () => []),
      listCities: vi.fn(async () => []),
    }

    const adapter = createLookupsRepositoryAdapter({ primary, fallback, usePrimary: false })

    await expect(adapter.listDocumentTypes()).resolves.toEqual([{ code: 'NIT' }])
    expect(primary.listDocumentTypes).not.toHaveBeenCalled()
    expect(fallback.listDocumentTypes).toHaveBeenCalledOnce()
  })

  it('usa backend cuando esta habilitado y cae a fallback si falla', async () => {
    const primary = {
      listDocumentTypes: vi.fn(async () => { throw new Error('backend down') }),
      listDepartments: vi.fn(async () => []),
      listCities: vi.fn(async () => []),
    }
    const fallback = {
      listDocumentTypes: vi.fn(async () => [{ code: 'CC' }]),
      listDepartments: vi.fn(async () => []),
      listCities: vi.fn(async () => []),
    }

    const adapter = createLookupsRepositoryAdapter({ primary, fallback, usePrimary: true })

    await expect(adapter.listDocumentTypes()).resolves.toEqual([{ code: 'CC' }])
    expect(primary.listDocumentTypes).toHaveBeenCalledOnce()
    expect(fallback.listDocumentTypes).toHaveBeenCalledOnce()
  })

  it('normaliza errores del repositorio con metadata de arquitectura', async () => {
    const fallback = {
      listDocumentTypes: vi.fn(async () => { throw new Error('db down') }),
      listDepartments: vi.fn(async () => []),
      listCities: vi.fn(async () => []),
    }

    const adapter = createLookupsRepositoryAdapter({ fallback, usePrimary: false })

    await expect(adapter.listDocumentTypes()).rejects.toMatchObject({
      name: 'OfironeGatewayError',
      code: 'DATA_ACCESS_ERROR',
      domain: 'lookups',
      operation: 'listDocumentTypes',
      retryable: false,
    })
  })
})
