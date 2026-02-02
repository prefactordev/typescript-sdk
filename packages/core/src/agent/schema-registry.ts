import type { SchemaRegistration } from '../queue/actions.js';

export class SchemaRegistry {
  private schemas = new Map<string, SchemaRegistration>();

  register(schema: SchemaRegistration): void {
    this.schemas.set(this.getKey(schema.schemaName, schema.schemaIdentifier), schema);
  }

  has(schemaName: string, schemaIdentifier: string): boolean {
    return this.schemas.has(this.getKey(schemaName, schemaIdentifier));
  }

  get(schemaName: string, schemaIdentifier: string): SchemaRegistration | undefined {
    return this.schemas.get(this.getKey(schemaName, schemaIdentifier));
  }

  private getKey(schemaName: string, schemaIdentifier: string): string {
    return `${schemaName}@${schemaIdentifier}`;
  }
}
