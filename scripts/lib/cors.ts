export type CorsRule = {
  AllowedOrigins: string[];
  AllowedMethods: string[];
  AllowedHeaders: string[];
  ExposeHeaders: string[];
  MaxAgeSeconds: number;
};

/** The media bucket's one CORS rule (D-143) for the given site origins, in the shape PutBucketCors takes. */
export function mediaCorsRules(origins: readonly string[]): { CORSRules: CorsRule[] } {
  return {
    CORSRules: [
      {
        AllowedOrigins: [...origins],
        AllowedMethods: ['GET', 'HEAD', 'POST', 'PUT'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3000,
      },
    ],
  };
}
