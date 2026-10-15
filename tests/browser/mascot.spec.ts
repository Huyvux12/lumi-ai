import { test, expect } from "@playwright/test";

for (const { name, path, viewport } of [
  {
    name: "desktop login",
    path: "/login",
    viewport: { width: 1280, height: 800 },
  },
  {
    name: "mobile login",
    path: "/login",
    viewport: { width: 390, height: 844 },
  },
  { name: "signup", path: "/signup", viewport: { width: 1280, height: 800 } },
]) {
  test(`${name} mascot keeps its eyes on its face throughout a natural blink`, async ({
    page,
  }) => {
    // Fix the interval at 3.6s while exercising the real React timer and Motion animation.
    await page.addInitScript(() => {
      Math.random = () => 0.5;
    });
    await page.setViewportSize(viewport);
    await page.goto(path);
    const mascot = page.getByRole("img", {
      name: "PersonaX, linh hồn kể chuyện",
    });
    await expect(mascot).toBeVisible();
    const samples = await mascot.evaluate(async (element) => {
      const eye =
        element.querySelector<SVGEllipseElement>('ellipse[rx="9.5"]')!;
      const eyes = eye.parentElement!.parentElement! as unknown as SVGGElement;
      const body = eyes.parentElement! as unknown as SVGGElement;
      const samples: { scaleY: number; y: number; x: number }[] = [];
      const start = performance.now();
      while (performance.now() - start < 5400) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const relative = body
          .getScreenCTM()!
          .inverse()
          .multiply(eye.getScreenCTM()!);
        const point = new DOMPoint(
          eye.cx.baseVal.value,
          eye.cy.baseVal.value,
        ).matrixTransform(relative);
        samples.push({
          scaleY: Math.hypot(relative.c, relative.d),
          y: point.y,
          x: point.x,
        });
      }
      return samples;
    });
    const blink = samples.filter((sample) => sample.scaleY < 0.3);
    expect(
      blink.length,
      "The test must observe a real closed-eye frame",
    ).toBeGreaterThan(0);
    expect(
      Math.max(...samples.map((sample) => Math.abs(sample.y - 112))),
      "Blinking must keep the eye at face height in body coordinates",
    ).toBeLessThan(6);
    expect(
      Math.max(...samples.map((sample) => Math.abs(sample.x - 80))),
    ).toBeLessThan(6);
  });
}
