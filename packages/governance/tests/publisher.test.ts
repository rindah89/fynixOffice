import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildOfficeStatement,
  controlIds,
  loadOfficeProcessorInventory,
  publishOfficeControl,
  publishOfficeStatement,
  synchronizeOfficeProcessorInventory,
} from '../src/index.js'

describe('Office governance publisher', () => {
  it('reports all controls and preserves known gaps', () => {
    const statement = buildOfficeStatement('tenant-1', new Date('2026-08-28T12:00:00Z'))
    expect(statement.payload.controls.map((control) => control.control_id)).toEqual(controlIds)
    expect(new Set(statement.payload.controls.map((control) => control.control_id)).size).toBe(12)
    expect(
      statement.payload.controls.find((control) => control.control_id === 'DG-05')?.status,
    ).toBe('partially_effective')
    expect(
      statement.payload.controls.find((control) => control.control_id === 'DG-03'),
    ).toMatchObject({
      status: 'partially_effective',
      metrics: { privacy_access_export: true, secret_redaction: true, erasure_fulfillment: true },
    })
    expect(
      statement.payload.controls.find((control) => control.control_id === 'DG-12')?.status,
    ).toBe('effective')
    expect(
      statement.payload.controls.find((control) => control.control_id === 'DG-12')?.metrics,
    ).toMatchObject({ high_severity_dependency_findings: 0 })
  })

  it('publishes signed tenant-bound evidence and validates the receipt', async () => {
    const upstream = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
      const body = JSON.parse(init.body) as { entity_id: string; tenant_id: string }
      const headers = new Headers(init.headers)
      expect(body.tenant_id).toBe('tenant-1')
      expect(headers.get('X-Fynix-Source')).toBe('office')
      expect(headers.get('X-Fynix-Signature')).toMatch(/^v2=/)
      return Promise.resolve(
        new Response(JSON.stringify({ outcome: 'recorded', statement_id: body.entity_id }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    await expect(
      publishOfficeStatement(
        {
          endpoint: 'https://cyberaudit.example/evidence',
          tenantId: 'tenant-1',
          webhookId: 'webhook',
          secret: 'x'.repeat(32),
        },
        upstream,
      ),
    ).resolves.toMatchObject({ outcome: 'recorded' })
  })

  it('rejects insecure remote endpoints', async () => {
    await expect(
      publishOfficeStatement({
        endpoint: 'http://example.com/evidence',
        tenantId: 'tenant',
        webhookId: 'webhook',
        secret: 'x'.repeat(32),
      }),
    ).rejects.toThrow(/HTTPS/)
  })

  it('publishes signed governance control commands', async () => {
    const upstream = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ tenant_id: 'tenant-1', command: 'processor.register' })
      expect(new Headers(init?.headers).get('X-Fynix-Event')).toBe('governance.control.commanded')
      return new Response(
        JSON.stringify({ outcome: 'recorded', resource_type: 'data_processor', resource_id: 5 }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      )
    })
    await expect(
      publishOfficeControl(
        {
          endpoint: 'https://cyberaudit.example/controls',
          tenantId: 'tenant-1',
          webhookId: 'webhook',
          secret: 'x'.repeat(32),
        },
        'processor.register',
        { name: 'AI' },
        upstream,
      ),
    ).resolves.toMatchObject({ resource_id: 5 })
  })

  it('validates, synchronizes and conditionally promotes the processor register', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'office-processors-')), 'inventory.json')
    writeFileSync(path, JSON.stringify([{
      name: 'AI provider', purpose: 'Document assistance', data_categories: ['document prompts'],
      processing_countries: ['CM'], transfer_mechanism: null, agreement_owner: 'Privacy Office',
      agreement_evidence_ref: 'urn:fynix:agreement:office-ai',
      agreement_evidence_sha256: 'a'.repeat(64), review_due_at: '2027-08-28T00:00:00Z',
    }]))
    const inventory = loadOfficeProcessorInventory(path)
    expect(buildOfficeStatement(
      'tenant', new Date('2026-08-28T12:00:00Z'), inventory,
    ).payload.controls.find((control) => control.control_id === 'DG-11')).toMatchObject({
      status: 'effective', metrics: { declared_processors: 1 },
    })
    const upstream = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
      const body = JSON.parse(init.body)
      expect(body).toMatchObject({ command: 'processor.register', payload: { name: 'AI provider' } })
      return new Response(
        JSON.stringify({ outcome: 'recorded', resource_type: 'processor', resource_id: 8 }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      )
    })
    await expect(synchronizeOfficeProcessorInventory({
      endpoint: 'https://cyberaudit.example/controls', tenantId: 'tenant',
      webhookId: 'webhook', secret: 'x'.repeat(32),
    }, inventory, upstream)).resolves.toHaveLength(1)
  })

  it('rejects incomplete processor inventory', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'office-processors-')), 'inventory.json')
    writeFileSync(path, '[{"name":"incomplete"}]')
    expect(() => loadOfficeProcessorInventory(path)).toThrow(/invalid schema/)
  })
})
