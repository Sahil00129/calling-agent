"use client";

/**
 * Renders markup that came from the PHP build and then boots its page script.
 *
 * The script is a plain ES module that queries the DOM by id and fills it in, so it
 * has to run *after* the markup is on screen — hence the effect. React never
 * re-renders the injected subtree, so the script's DOM work survives.
 */

import { useEffect } from "react";

interface Props {
  html: string;
  script: string;
  /** Test harness only: warn on screen if the module never executed. */
  watchdog?: boolean;
}

export default function LegacyPage({ html, script, watchdog = false }: Props) {
  useEffect(() => {
    const tag = document.createElement("script");
    tag.type = "module";
    tag.src = script;
    tag.dataset.legacy = "1";
    document.body.appendChild(tag);

    let timer: ReturnType<typeof setTimeout> | undefined;

    if (watchdog) {
      timer = setTimeout(() => {
        if ((window as { __EL_TEST_BOOTED?: boolean }).__EL_TEST_BOOTED) return;

        const state = document.getElementById("keyState");
        if (state) {
          state.innerHTML =
            '<span class="dot bad"></span>app.js did not run — open the browser console (F12) ' +
            "for the exact error.";
        }
        document.querySelectorAll("button").forEach((button) => {
          (button as HTMLButtonElement).disabled = true;
        });
      }, 2500);
    }

    return () => {
      tag.remove();
      if (timer) clearTimeout(timer);
    };
  }, [script, watchdog]);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
