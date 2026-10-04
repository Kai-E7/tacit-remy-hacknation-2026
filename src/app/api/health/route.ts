export function GET() {
  return Response.json({
    status: "ok",
    service: "ai-apprentice",
    milestone: "screen-capture-foundation",
    access: "public-demo",
  });
}
