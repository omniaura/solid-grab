import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";

function Counter(props: JSX.HTMLAttributes<HTMLElement>) {
  const [count, setCount] = createSignal(0);
  return (
    <section {...props}>
      <h2>Reactive counter</h2>
      <button id="counter" onClick={() => setCount(count() + 1)}>Count: {count()}</button>
    </section>
  );
}

function App() {
  return (
    <main style={{ "max-width": "640px", margin: "80px auto", padding: "24px", "font-family": "system-ui" }}>
      <h1>Solid Grab + Solid 2</h1>
      <p>Hold Alt, hover the counter, then click to copy its source context.</p>
      <p>The grab click should not increment the counter. Release Alt to use it normally.</p>
      <Counter />
    </main>
  );
}

render(() => <App />, document.getElementById("app")!);
