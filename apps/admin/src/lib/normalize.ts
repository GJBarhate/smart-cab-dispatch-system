// The Alert model on the server predates baseSchemaOptions' toJSON transform
// (see apps/server/src/models/Alert.ts) and so serializes `_id` instead of
// `id`, unlike every other model. Rather than patch the shared backend
// (out of scope for this frontend build and risks the server's own test
// suite), normalize it once at the API boundary.
export function withId<T extends { id?: string; _id?: string }>(item: T): T & { id: string } {
  return { ...item, id: item.id ?? item._id ?? '' };
}

export function withIds<T extends { id?: string; _id?: string }>(items: T[]): Array<T & { id: string }> {
  return items.map(withId);
}
