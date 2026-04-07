/**
 * PromptRegistry — YAML-based prompt template management.
 *
 * Loads, validates, compiles, and renders prompt templates from YAML files.
 * All templates are compiled at startup to catch errors early.
 *
 * Template format (YAML):
 *   name: chat-discussion
 *   version: 3
 *   variables:
 *     - name: worldbuilding
 *       required: false
 *   template: |
 *     你是一位专业的中文小说创作助手。
 *     {{#if worldbuilding}}
 *     ## 世界观设定
 *     {{worldbuilding}}
 *     {{/if}}
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import Handlebars from 'handlebars'

export interface PromptVariable {
  name: string
  required?: boolean
  description?: string
}

export interface PromptDefinition {
  name: string
  version: number
  description?: string
  variables?: PromptVariable[]
  template: string
}

interface CompiledPrompt {
  definition: PromptDefinition
  render: (vars: Record<string, unknown>) => string
}

export class PromptRegistry {
  private prompts = new Map<string, CompiledPrompt>()

  /** Load all YAML files from a directory. */
  loadDirectory(dir: string): void {
    const absDir = resolve(dir)
    let files: string[]
    try {
      files = readdirSync(absDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    } catch (e) {
      throw new Error(`Failed to read prompts directory '${absDir}': ${e}`)
    }

    for (const file of files) {
      this.loadFile(join(absDir, file))
    }
  }

  /** Load and compile a single YAML prompt file. */
  loadFile(filePath: string): void {
    const raw = readFileSync(filePath, 'utf-8')
    const def = parseYaml(raw) as PromptDefinition

    this.validate(def, filePath)
    this.compile(def)
  }

  /** Load from a raw definition object (for testing). */
  loadDefinition(def: PromptDefinition): void {
    this.validate(def, '<inline>')
    this.compile(def)
  }

  /** Render a prompt template with variables. */
  render(name: string, vars: Record<string, unknown> = {}): string {
    const compiled = this.prompts.get(name)
    if (!compiled) {
      throw new Error(`Prompt not found: '${name}'. Available: ${[...this.prompts.keys()].join(', ')}`)
    }

    // Check required variables
    const missing = (compiled.definition.variables ?? [])
      .filter(v => v.required && (vars[v.name] === undefined || vars[v.name] === null || vars[v.name] === ''))
    if (missing.length > 0) {
      throw new Error(
        `Missing required variables for prompt '${name}': ${missing.map(v => v.name).join(', ')}`,
      )
    }

    // Check for undeclared variables
    const declared = new Set((compiled.definition.variables ?? []).map(v => v.name))
    const undeclared = Object.keys(vars).filter(k => !declared.has(k))
    if (undeclared.length > 0) {
      throw new Error(
        `Undeclared variables for prompt '${name}': ${undeclared.join(', ')}. ` +
        `Declared: ${[...declared].join(', ')}`,
      )
    }

    return compiled.render(vars)
  }

  /** Get a prompt definition by name. */
  get(name: string): PromptDefinition | undefined {
    return this.prompts.get(name)?.definition
  }

  /** List all loaded prompt names. */
  list(): string[] {
    return [...this.prompts.keys()]
  }

  /** Get the count of loaded prompts. */
  get size(): number {
    return this.prompts.size
  }

  // ─── Private ───

  private validate(def: PromptDefinition, source: string): void {
    if (!def.name || typeof def.name !== 'string') {
      throw new Error(`Invalid prompt in '${source}': missing or invalid 'name'`)
    }
    if (typeof def.version !== 'number' || def.version < 1) {
      throw new Error(`Invalid prompt '${def.name}' in '${source}': 'version' must be a positive integer`)
    }
    if (!def.template || typeof def.template !== 'string') {
      throw new Error(`Invalid prompt '${def.name}' in '${source}': missing or invalid 'template'`)
    }
    if (def.variables && !Array.isArray(def.variables)) {
      throw new Error(`Invalid prompt '${def.name}' in '${source}': 'variables' must be an array`)
    }
    for (const v of def.variables ?? []) {
      if (!v.name || typeof v.name !== 'string') {
        throw new Error(`Invalid variable in prompt '${def.name}' in '${source}': missing 'name'`)
      }
    }
  }

  private compile(def: PromptDefinition): void {
    try {
      const template = Handlebars.compile(def.template, { noEscape: true })
      this.prompts.set(def.name, { definition: def, render: template })
    } catch (e) {
      throw new Error(`Failed to compile prompt '${def.name}': ${e}`)
    }
  }
}
