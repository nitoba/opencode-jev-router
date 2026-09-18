import { z } from "zod";
import type { RouterConfig } from "./types.ts";

const probability = z.number().finite().min(0).max(1);
const modelOptions = z.record(z.string().min(1), z.record(z.string().min(1), z.unknown()));

const optionsSchema = z
  .object({
    mode: z.enum(["observe", "shortlist", "strict"]).default("shortlist"),
    apiKeyEnv: z.string().min(1).default("TYPESAFE_API_KEY"),
    model: z.string().min(1).default("jev-latest"),
    baseURL: z.string().url().optional(),
    timeout: z.union([z.string().min(1), z.number().int().positive()]).default("2 seconds"),
    retry: z.union([z.literal(false), z.number().int().min(0).max(10)]).default(false),
    hardThreshold: probability.default(0.8),
    softThreshold: probability.default(0.55),
    doneThreshold: probability.default(0.7),
    topK: z.number().int().min(1).max(254).default(3),
    minTools: z.number().int().min(1).default(2),
    maxToolDescriptionChars: z.number().int().min(160).max(4_000).default(900),
    debug: z.boolean().default(false),
    modelOptions: modelOptions.default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.softThreshold > value.hardThreshold) {
      context.addIssue({
        code: "custom",
        path: ["softThreshold"],
        message: "softThreshold must be less than or equal to hardThreshold",
      });
    }
  });

export type PluginOptions = z.input<typeof optionsSchema>;

export const DEFAULT_CONFIG = Object.freeze({
  mode: "shortlist",
  apiKeyEnv: "TYPESAFE_API_KEY",
  model: "jev-latest",
  timeout: "2 seconds",
  retry: false,
  hardThreshold: 0.8,
  softThreshold: 0.55,
  doneThreshold: 0.7,
  topK: 3,
  minTools: 2,
  maxToolDescriptionChars: 900,
  debuYÎˆ˜[ÙKˆ[Ù[Ü[ÛœÎˆßKŸHØ]\ÙšY\ÈÛZ]›İ]\ÛÛ™šYË˜˜\ÙUT“ŠNÂ‚™^Ü[˜İ[Ûˆ\œÙPÛÛ™šYÊ[œ]ˆ[šÛ›İÛŠNˆ›İ]\ÛÛ™šYÈÂˆÛÛœİ\œÙYHÜ[ÛœÔØÚ[XKœ\œÙJ[œ]ÏÈßJNÂˆ™]\›ˆÂˆ[ÙNˆ\œÙY›[ÙKˆ\RÙ^Q[ˆ\œÙY˜\RÙ^Q[‹ˆ[Ù[ˆ\œÙY›[Ù[ˆ‹‹Š\œÙY˜˜\ÙUT“OOH[™Yš[™YÈßHˆÈ˜\ÙUT“ˆ\œÙY˜˜\ÙUT“JKˆ[Y[İ]ˆ\œÙY[Y[İ]ˆ™]Nˆ\œÙYœ™]Kˆ\™™\ÚÛˆ\œÙYš\™™\ÚÛˆÛÙ™\ÚÛˆ\œÙYœÛÙ™\ÚÛˆÛ™U™\ÚÛˆ\œÙY™Û™U™\ÚÛˆÜÎˆ\œÙYÜËˆZ[•ÛÛÎˆ\œÙY›Z[•ÛÛËˆX^ÛÛ\ØÜš\[ÛÚ\œÎˆ\œÙY›X^ÛÛ\ØÜš\[ÛÚ\œËˆXYÎˆ\œÙY™XYËˆ[Ù[Ü[ÛœÎˆ\œÙY›[Ù[Ü[ÛœËˆNÂŸB