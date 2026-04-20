import { z } from 'zod';

export const propertyValueTypeSchema = z.enum(['STRING', 'LABEL', 'REAL', 'INTEGER', 'BOOLEAN']);

export const propertyValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

export const snapshotPropertySchema = z.object({
  psetName: z.string().min(1),
  propertyName: z.string().min(1),
  valueType: propertyValueTypeSchema,
  value: propertyValueSchema,
});

export const snapshotElementSchema = z.object({
  expressId: z.number().int().positive(),
  globalId: z.string().trim().optional().nullable(),
  entityType: z.string().trim().optional().nullable(),
  name: z.string().trim().optional().nullable(),
  objectType: z.string().trim().optional().nullable(),
  predefinedType: z.string().trim().optional().nullable(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  rawData: jsonValueSchema.nullable().optional().default(null),
  properties: z.array(snapshotPropertySchema),
});

export const startSnapshotSchema = z.object({
  totalElements: z.number().int().nonnegative(),
  totalChunks: z.number().int().positive(),
});

export const uploadSnapshotChunkSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  elements: z.array(snapshotElementSchema),
});

export const completeSnapshotSchema = z.object({
  totalElements: z.number().int().nonnegative(),
  totalProperties: z.number().int().nonnegative(),
});

export const failSnapshotSchema = z.object({
  reason: z.string().trim().max(4000).nullable().optional().default(null),
});

export const customPropertySchema = z.object({
  expressId: z.number().int().positive(),
  psetName: z.string().min(1),
  propertyName: z.string().min(1),
  valueType: propertyValueTypeSchema,
  value: propertyValueSchema,
});

export const annotationSchema = z.object({
  clientId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  text: z.string().min(1),
});

export const bootstrapOverlaysSchema = z.object({
  customProperties: z.array(customPropertySchema).default([]),
  annotations: z.array(annotationSchema).default([]),
});

export type SnapshotPropertyInput = z.infer<typeof snapshotPropertySchema>;
export type SnapshotElementInput = z.infer<typeof snapshotElementSchema>;
export type StartSnapshotInput = z.infer<typeof startSnapshotSchema>;
export type UploadSnapshotChunkInput = z.infer<typeof uploadSnapshotChunkSchema>;
export type CompleteSnapshotInput = z.infer<typeof completeSnapshotSchema>;
export type FailSnapshotInput = z.infer<typeof failSnapshotSchema>;
export type CustomPropertyInput = z.infer<typeof customPropertySchema>;
export type AnnotationInput = z.infer<typeof annotationSchema>;
export type BootstrapOverlaysInput = z.infer<typeof bootstrapOverlaysSchema>;
