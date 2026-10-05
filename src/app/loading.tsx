export default function Loading() {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-4 py-6 sm:px-6 lg:px-14" aria-busy="true" aria-label="Đang tải">
      {[0, 1].map((r) => (
        <div key={r} className="flex flex-col gap-3">
          <div className="h-5 w-32 animate-pulse rounded bg-surface" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl bg-surface" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
