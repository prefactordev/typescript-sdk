import type { SchemaRegistration } from '../queue/actions.js';

export class SchemaRegistry {
  private schemas = new Map<string, SchemaRegistration>();

  register(schema: SchemaRegistration): void {
    this.schemas.set(this.getKey(schema.schemaName, schema.schemaVersion), schema);
  }

  get(schemaName: string, schemaVersion: string): SchemaRegistration | undefined {
    return this.schemas.get(this.getKey(schemaName, schemaVersion));
  }

  private getKey(schemaName: string, schemaVersion: string): string {
    return `${schemaName}@${schemaVersion}`;
  }
}
