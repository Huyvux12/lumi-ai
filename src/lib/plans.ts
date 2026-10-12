export type PublicPlan = {
  code: "free" | "premium";
  price_vnd: number;
  description: string;
  enabled: boolean;
  discount_percent: number;
  closed_message: string | null;
};
