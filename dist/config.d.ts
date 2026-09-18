import { z } from "zod";
import type { RouterConfig } from "./types.ts";
declare const optionsSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<{
        observe: "observe";
        shortlist: "shortlist";
        strict: "strict";
    }>>;
    provider: z.ZodDefault<z.ZodEnum<{
        typesafe: "typesafe";
        vercel: "vercel";
    }>>;
    apiKey: z.ZodOptional<z.ZodString>;
    apiKeyEnv: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    baseURL: z.ZodOptional<z.ZodString>;
    timeout: z.ZodDefault<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
    retry: z.ZodDefault<z.ZodUnion<readonly [z.ZodLiteral<false>, z.ZodNumber]>>;
    hardThreshold: z.ZodDefault<z.ZodNumber>;
    softThreshold: z.ZodDefault<z.ZodNumber>;
    doneThreshold: z.ZodDefault<z.ZodNumber>;
    topK: z.ZodDefault<z.ZodNumber>;
    minTools: z.ZodDefault<z.ZodNumber>;
    maxToolDescriptionChars: z.ZodDefault<z.ZodNumber>;
    debug: z.ZodDefault<z.ZodBoolean>;
    modelOptions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$strict>;
export type PluginOptions = z.input<typeof optionsSchema>;
export declare const DEFAULT_CONFIG: Readonly<{
    mode: "shortlist";
    provider: "typesafe";
    apiKeyEnv: string;
    model: string;
    timeout: string;
    retry: false;
    hardThreshold: number;
    softThreshold: number;
    doneThreshold: number;
    topK: number;
    minTools: number;
    maxToolDescriptionChars: number;
    debug: false;
    modelOptions: {};
}>;
export declare function parseConfig(input: unknown): RouterConfig;
export {};
//# sourceMappingURL=config.d.ts.map