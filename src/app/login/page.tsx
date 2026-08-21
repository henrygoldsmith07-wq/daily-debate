import AuthForm from "./AuthForm";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-[var(--background)] px-6 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Daily Debate</h1>
        <p className="max-w-xs text-sm text-ink3">
          Argue with an AI, get scored on how sharp your thinking is, then take on other players.
        </p>
      </div>
      <AuthForm />
    </div>
  );
}
