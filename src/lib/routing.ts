import type { Credential, RoutingSettings, RoutingValues } from '../types'

export const DEFAULT_ROUTING: RoutingSettings = {
  mode: 'none',
  groups: {
    normal: { priority: 10, weight: 10 },
    downshift: { priority: -10, weight: 1 },
    ungrouped: { priority: 0, weight: 10 },
  },
  overrides: {},
}

export function normalizeRoutingValue(value: number, field: keyof RoutingValues): number {
  return Math.min(9999, Math.max(field === 'weight' ? 0 : -9999, Math.trunc(value) || 0))
}

export function routingFor(credential: Pick<Credential, 'id' | 'group' | 'routing'>, routing: RoutingSettings): RoutingValues {
  return credential.routing ?? routing.overrides[credential.id] ?? routing.groups[credential.group ?? 'ungrouped']
}

export function normalizeRouting(value?: Partial<RoutingSettings>): RoutingSettings {
  const normalize = (values?: RoutingValues, defaults: RoutingValues = { priority: 0, weight: 1 }): RoutingValues => ({
    priority: normalizeRoutingValue(values?.priority ?? defaults.priority, 'priority'),
    weight: normalizeRoutingValue(values?.weight ?? defaults.weight, 'weight'),
  })
  const mode = value?.mode === 'prefix' || value?.mode === 'priority' || value?.mode === 'none' ? value.mode : 'none'
  return {
    mode,
    groups: {
      normal: normalize(value?.groups?.normal, DEFAULT_ROUTING.groups.normal),
      downshift: normalize(value?.groups?.downshift, DEFAULT_ROUTING.groups.downshift),
      ungrouped: normalize(value?.groups?.ungrouped, DEFAULT_ROUTING.groups.ungrouped),
    },
    overrides: Object.fromEntries(Object.entries(value?.overrides ?? {}).map(([id, values]) => [id, normalize(values)])),
  }
}
