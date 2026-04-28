import { useState } from "react";

type Props = {
  disabled?: boolean;
  initialValue?: string;
  history?: string[];
  onSubmit: (text: string) => void;
  onReuseHistory?: (text: string) => void;
};

export function SubmitPanel({
  disabled,
  initialValue = "",
  history = [],
  onSubmit,
  onReuseHistory,
}: Props) {
  const [text, setText] = useState(initialValue);

  return (
    <section className="panel submit-panel">
      <h3>Submit Diagnosis</h3>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Describe your investigation, root cause, and fix plan."
        rows={8}
      />
      <div className="row-end">
        <button
          disabled={disabled || !text.trim()}
          onClick={() => {
            onSubmit(text.trim());
            setText("");
          }}
        >
          Submit Analysis
        </button>
      </div>

      {history.length ? (
        <div className="history-block">
          <h4>Local Submit History</h4>
          <ul>
            {history.map((item, idx) => (
              <li key={`${idx}-${item.slice(0, 20)}`}>
                <button
                  className="link-like"
                  onClick={() => {
                    setText(item);
                    onReuseHistory?.(item);
                  }}
                >
                  {item.slice(0, 120)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
