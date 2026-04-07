/**
 * PromptRegistry Tests
 *
 * Tests YAML loading, validation, compilation, rendering,
 * and variable whitelist enforcement.
 */
import { describe, it, expect } from 'bun:test'
import { PromptRegistry } from '../prompts/registry.js'
import { resolve } from 'node:path'

const PROMPTS_DIR = resolve(import.meta.dir, '../prompts')

describe('PromptRegistry - loading', () => {
  it('loads all YAML files from prompts directory', () => {
    const registry = new PromptRegistry()
    registry.loadDirectory(PROMPTS_DIR)
    expect(registry.size).toBeGreaterThan(0)
    expect(registry.list()).toContain('compact')
    expect(registry.list()).toContain('extract')
    expect(registry.list()).toContain('transform-polish')
  })

  it('loads all expected prompt files', () => {
    const registry = new PromptRegistry()
    registry.loadDirectory(PROMPTS_DIR)
    const expected = [
      'compact', 'extract',
      'transform-polish', 'transform-expand', 'transform-condense', 'transform-restyle',
    ]
    for (const name of expected) {
      expect(registry.get(name)).toBeDefined()
    }
  })

  it('each prompt has version >= 1', () => {
    const registry = new PromptRegistry()
    registry.loadDirectory(PROMPTS_DIR)
    for (const name of registry.list()) {
      const def = registry.get(name)!
      expect(def.version).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('PromptRegistry - inline definition', () => {
  it('loads and renders a simple template', () => {
    const registry = new PromptRegistry()
    registry.loadDefinition({
      name: 'test',
      version: 1,
      variables: [{ name: 'name', required: true }],
      template: '你好，{{name}}！',
    })

    const result = registry.render('test', { name: '张三' })
    expect(result).toBe('你好，张三！')
  })

  it('renders conditional blocks', () => {
    const registry = new PromptRegistry()
    registry.loadDefinition({
      name: 'cond',
      version: 1,
      variables: [
        { name: 'worldbuilding', required: false },
      ],
      template: '基础提示词\n{{#if worldbuilding}}\n世界观：{{worldbuilding}}\n{{/if}}',
    })

    const with_wb = registry.render('cond', { worldbuilding: '仙侠世界' })
    expect(with_wb).toContain('世界观：仙侠世界')

    const without_wb = registry.render('cond', {})
    expect(without_wb).not.toContain('世界观')
  })
})

describe('PromptRegistry - validation', () => {
  it('rejects missing name', () => {
    const registry = new PromptRegistry()
    expect(() => registry.loadDefinition({
      name: '',
      version: 1,
      template: 'test',
    })).toThrow('missing or invalid')
  })

  it('rejects version < 1', () => {
    const registry = new PromptRegistry()
    expect(() => registry.loadDefinition({
      name: 'bad',
      version: 0,
      template: 'test',
    })).toThrow('positive integer')
  })

  it('rejects missing template', () => {
    const registry = new PromptRegistry()
    expect(() => registry.loadDefinition({
      name: 'bad',
      version: 1,
      template: '',
    })).toThrow('missing or invalid')
  })
})

describe('PromptRegistry - variable enforcement', () => {
  it('throws on missing required variable', () => {
    const registry = new PromptRegistry()
    registry.loadDefinition({
      name: 'req',
      version: 1,
      variables: [{ name: 'important', required: true }],
      template: '{{important}}',
    })

    expect(() => registry.render('req', {})).toThrow('Missing required variables')
  })

  it('throws on undeclared variable', () => {
    const registry = new PromptRegistry()
    registry.loadDefinition({
      name: 'strict',
      version: 1,
      variables: [{ name: 'a' }],
      template: '{{a}}',
    })

    expect(() => registry.render('strict', { a: '1', b: '2' })).toThrow('Undeclared variables')
  })

  it('allows optional variable to be absent', () => {
    const registry = new PromptRegistry()
    registry.loadDefinition({
      name: 'opt',
      version: 1,
      variables: [{ name: 'optional', required: false }],
      template: 'result: {{optional}}',
    })

    // Should not throw
    const result = registry.render('opt', {})
    expect(result).toBe('result: ')
  })
})

describe('PromptRegistry - transform prompts', () => {
  it('restyle requires style variable', () => {
    const registry = new PromptRegistry()
    registry.loadDirectory(PROMPTS_DIR)

    expect(() => registry.render('transform-restyle', {})).toThrow('Missing required variables')

    const result = registry.render('transform-restyle', { style: '武侠' })
    expect(result).toContain('武侠')
  })

  it('polish/expand/condense have no required variables', () => {
    const registry = new PromptRegistry()
    registry.loadDirectory(PROMPTS_DIR)

    for (const name of ['transform-polish', 'transform-expand', 'transform-condense']) {
      // Should not throw
      const result = registry.render(name, {})
      expect(result.length).toBeGreaterThan(0)
    }
  })
})

describe('PromptRegistry - error handling', () => {
  it('throws on nonexistent prompt name', () => {
    const registry = new PromptRegistry()
    expect(() => registry.render('nonexistent')).toThrow('Prompt not found')
  })

  it('throws on nonexistent directory', () => {
    const registry = new PromptRegistry()
    expect(() => registry.loadDirectory('/nonexistent/path')).toThrow('Failed to read')
  })
})
