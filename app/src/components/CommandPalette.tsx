import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Portal } from "./Portal";
import { useApp } from "../state/appState";
import { ACTIONS, resolveBundle } from "../actions/registry";
import { openWorkroom, workroomContextFor, workroomModeFor } from "../workroom/openWorkroom";
import { openRelationshipRoom } from "./relationship/relSession";
import { relOpeningForAccount } from "./relationship/RelationshipRoom";
import { mcpAvailable } from "../channel/mcp";
import { MIN_QUERY, searchAccounts, type AccountMatch } from "../book/search";
import { announce, bookHas, openAccountLive } from "../book/dynamicBook";
import { currentGlass, currentPreference, setGlass } from "../glassMode";
import "../styles/cmdk.css";

/* =============================================================================
   SURFACE 6 — THE CMDK LENS (DIRECTION-LOCKED rule 63, 70.2, 46, 47).

   THE PALETTE IS A LENS. Opening it pushes the cockpit into depth of field
   (body.lensed, see cmdk.css) and the glass field rises out of the softness.
   This file owns the field, its commands and its keyboard; the defocus is
   entirely material and lives in the stylesheet.

   THE BOOK IS THE APP'S BOOK. The dummy authored three rows against one
   client; the port lists what this snapshot actually holds — every staged
   client, and the workroom actions the registry says are available on the
   client currently open. The materialize cascade is index-driven for exactly
   that reason: it has to fit however many commands there are.
   ============================================================================= */

/** The header's ⌘K chip opens the same palette the shortcut does (rule 45 puts
 *  search in that chip). An event rather than lifted state: the palette owns its
 *  own open/close and the header should not have to hold it. */
export const CMDK_OPEN_EVENT = "c360:cmdk-open";

type CommandKind = "Action" | "Client" | "View" | "Org";

interface Command {
  id: string;
  /** What the row reads. */
  label: string;
  /** The right-hand kind label, and part of what the filter matches. */
  kind: CommandKind;
  /** Extra text the filter should match but the row should not show. */
  aka?: string;
  run: () => void;
}

/** Cmd/Ctrl+K palette to jump to any staged account or open a workroom
 *  (SPEC §6.2, rule 63). */
export function CommandPalette() {
  const { data, state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const staged = useMemo(() => {
    const ids = new Set<string>(Object.keys(data.borrowers ?? {}));
    const anchor = data.borrower?.snapshot?.accountId;
    if (anchor) ids.add(anchor);
    const byId = new Map(data.portfolio.accounts.map((a) => [a.accountId, a]));
    return [...ids].map((id) => {
      const a = byId.get(id);
      const b = (data.borrowers ?? {})[id] ?? data.borrower;
      return { id, name: a?.name ?? b?.snapshot?.name ?? id, industry: a?.industry ?? b?.snapshot?.industry ?? "" };
    });
  }, [data]);

  const openAccountId = state.view === "account" ? state.accountId : null;

  /* ============================================ THE BOOK IS THE ORG'S BOOK

     The rows above are what this snapshot baked. `Customer360SearchAccounts` is
     the rest of it: a partial-name read the palette runs as the banker types,
     debounced, and only past three characters — two would match the book.

     A MATCH IS A CHIP, NOT A NAVIGATION. Picking one reads the relationship out
     of the org (the same eight reads the sync sweep runs, at the same pacing)
     and only then opens it. Nothing is rendered from a search hit: the hit is a
     name and an id, and every figure the cockpit shows comes off those reads.

     WITH NO CONNECTOR THIS DOES NOT RUN AT ALL and the palette is exactly the
     palette it has always been. */
  const [matches, setMatches] = useState<AccountMatch[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "running" | "failed">("idle");

  useEffect(() => {
    const q = query.trim();
    if (!open || !mcpAvailable() || q.length < MIN_QUERY) {
      setMatches([]);
      setSearchState("idle");
      return;
    }
    let alive = true;
    setSearchState("running");
    const timer = window.setTimeout(() => {
      void searchAccounts(q)
        .then((res) => {
          if (!alive) return;
          setMatches(res.results);
          setSearchState("idle");
        })
        .catch(() => {
          if (!alive) return;
          setMatches([]);
          // A refused search is not an empty org. The row says which.
          setSearchState("failed");
        });
    }, 280);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  /** Open a relationship the snapshot never baked: read it, then go. */
  const openFromOrg = (match: AccountMatch) => {
    void openAccountLive({ accountId: match.accountId, name: match.name, match }).then((ok) => {
      if (ok) dispatch({ type: "OPEN_ACCOUNT", accountId: match.accountId });
      else announce(`the org had nothing to read for ${match.name}. Nothing was opened.`);
    });
  };

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];

    /* ACTIONS FIRST, and only the ones that are real right now. A palette row
       is a thing the banker can do, so an action the registry says this data
       cannot support does not get one — unlike the Client Actions control
       centre, which keeps it visible and disabled because its job is to be the
       map of what exists (A27.3). They route through the SAME seam that panel
       uses, `openWorkroom(workroomContextFor(...))`, so the room can never
       disagree with itself about which package a banker is standing in. */
    const stagedIds = new Set(staged.map((s) => s.id));
    const bookIds = new Set(data.portfolio.accounts.map((a) => a.accountId));
    const accountName = openAccountId ? staged.find((s) => s.id === openAccountId)?.name : null;
    if (openAccountId && accountName) {
      /* THE RELATIONSHIP ROOM IS ONE ROW, not five. It is a room the banker
         opens on a relationship and whose first question picks the review, so
         a palette listing its five routes separately would be answering that
         question for them. It routes through the SAME opener the arc uses, and
         it carries the same derived signal — the palette never opens a room on
         a different read from the one the FAB would. */
      out.push({
        id: "action:relationship-actions",
        label: `Relationship Actions · ${accountName}`,
        kind: "Action",
        aka: "annual review covenant review collateral valuation risk rating service request",
        run: () =>
          openRelationshipRoom({
            accountId: openAccountId,
            accountName,
            opening: relOpeningForAccount({ data, accountId: openAccountId }),
          }),
      });
      for (const action of ACTIONS) {
        const mode = workroomModeFor(action.id);
        if (!mode || !action.availability(data, openAccountId).available) continue;
        out.push({
          id: `action:${action.id}`,
          label: `${action.label} · ${accountName}`,
          kind: "Action",
          run: () =>
            openWorkroom(
              workroomContextFor({
                mode,
                data,
                bundle: resolveBundle(data, openAccountId),
                accountId: openAccountId,
                accountName,
              }),
            ),
        });
      }
    }

    for (const s of staged) {
      out.push({
        id: `client:${s.id}`,
        label: `Open ${s.name}`,
        kind: "Client",
        // The industry stays searchable without crowding the row: the dummy's
        // row shape is one line plus its kind, and this palette already let a
        // banker find a client by sector.
        aka: s.industry,
        run: () => dispatch({ type: "OPEN_ACCOUNT", accountId: s.id }),
      });
    }

    /* AND THE REST OF THE PACKAGED BOOK, which since 2026-09-08 the page can
       see: the Portfolio read carries every packaged account by name and id,
       so a relationship the landing lists (on the queue or under the quiet
       divider) is findable here without waiting on a debounced org search for
       a name already on screen. It has no bundle yet, so it opens the way an
       org match does — read first, then go — rather than dispatching straight
       into an empty workspace. */
    for (const a of data.portfolio.accounts) {
      if (!a.accountId || stagedIds.has(a.accountId)) continue;
      out.push({
        id: `book:${a.accountId}`,
        label: `Open ${a.name}`,
        kind: "Client",
        aka: `${a.industry ?? ""} ${a.naicsCode ?? ""}`.trim(),
        run: () => openFromOrg({ accountId: a.accountId, name: a.name, industry: a.industry, naicsCode: a.naicsCode }),
      });
    }

    /* THE ORG'S OWN MATCHES, under the book's. A relationship already staged
       (or already read live this session) keeps its one row: two rows for one
       borrower would be the palette disagreeing with itself about what is
       open. */
    for (const m of matches) {
      if (bookHas(data, m.accountId) || stagedIds.has(m.accountId) || bookIds.has(m.accountId)) continue;
      out.push({
        id: `org:${m.accountId}`,
        label: `Open ${m.name}`,
        kind: "Org",
        aka: `${m.industry ?? ""} ${m.naicsCode ?? ""}`.trim(),
        run: () => openFromOrg(m),
      });
    }

    out.push({
      id: "view:home",
      label: "Back to worklist",
      kind: "View",
      run: () => dispatch({ type: "GO_HOME" }),
    });

    /* THE MATERIAL, SWITCHABLE MID-DEMO (founder, 2026-09-03). Liquid is the
       default and there is no URL to type on a shared screen, so the way back
       to the frost is a palette row like any other. Two rows rather than one
       toggle: a toggle row has to say what it will do, which means its label
       changes under the reader between one keystroke and the next, and a
       palette whose rows rename themselves is a palette you cannot aim at.

       The switch is two classList calls in glassMode.ts and the next paint. No
       reload, no remount, nothing here re-renders: the stylesheet is doing all
       of it. The choice is written to localStorage so the next open keeps it,
       and a browser that refuses storage still gets the switch for this view.

       ONLY THE MODES A HUMAN WOULD ASK FOR. `?refract=1`, the subtle bend, is a
       preview lane for judging the two lenses side by side and it has no row:
       nobody stands in front of a client and asks for the middle one.

       FOUR ROWS SINCE 2026-09-04, because the page now has an opinion of its
       own. AUTO is the default and the one to come back to: liquid, with the
       frame sensor behind it, dropping to calm if this machine cannot hold the
       glass. CALM is that material asked for outright; the founder who knows
       the next hour is a screen share does not have to wait to be rescued. */
    const glass = currentGlass();
    const pref = currentPreference();
    out.push({
      id: "view:glass-auto",
      label: "Glass: auto",
      kind: "View",
      aka: `adaptive liquid until it stutters then calm ${pref === "auto" ? "current active" : "switch back"}`,
      run: () => setGlass("auto"),
    });
    out.push({
      id: "view:glass-liquid",
      label: "Glass: liquid",
      kind: "View",
      aka: `refraction bend lens ${pref === "liquid" ? "current active on" : "switch turn on"}`,
      run: () => setGlass("liquid"),
    });
    out.push({
      id: "view:glass-frost",
      label: "Glass: frost",
      kind: "View",
      aka: `plain blur no refraction ${pref === "frost" ? "current active" : "switch turn off"}`,
      run: () => setGlass("frost"),
    });
    out.push({
      id: "view:glass-calm",
      label: "Glass: calm",
      kind: "View",
      aka: `quiet screen share presenting still no bend half blur ${glass === "calm" ? "current active" : "switch"}`,
      run: () => setGlass("calm"),
    });

    return out;
    // `openFromOrg` closes over nothing but `dispatch`, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dispatch, matches, openAccountId, staged]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.kind} ${c.aka ?? ""}`.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    const onChip = () => setOpen(true);
    window.addEventListener(CMDK_OPEN_EVENT, onChip);
    return () => window.removeEventListener(CMDK_OPEN_EVENT, onChip);
  }, []);

  /* THE KEYBOARD LIVES ON THE WINDOW (rule 70.2). Arrow keys traverse the
     VISIBLE rows and Enter fires the selection, which has to hold whether or
     not the caret is in the field — a palette that only answers keys while its
     input has focus stops being keyboard-driven the moment anything else takes
     focus, and is unreachable to automation.

     NO DEPENDENCY ARRAY ON PURPOSE: the handler reads the current filter and
     the current selection, so it is rebound each render rather than closing
     over a stale pair. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      if (!visible.length) return;
      e.preventDefault();
      if (e.key === "Enter") {
        fire(visible[active] ?? visible[0]);
        return;
      }
      setActive((i) =>
        e.key === "ArrowDown" ? Math.min(i + 1, visible.length - 1) : Math.max(i - 1, 0),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    document.body.classList.add("lensed");
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      document.body.classList.remove("lensed");
    };
  }, [open]);

  /* THE FILTER LISTENS NATIVELY. React's value tracker swallows a programmatic
     `input.value = x` followed by a dispatched `input` event, which is how the
     acceptance probes and any keyboard automation drive this field. A native
     listener on an uncontrolled input answers both a real keystroke and a
     scripted one. */
  useEffect(() => {
    const el = inputRef.current;
    if (!open || !el) return;
    const onInput = () => {
      setQuery(el.value);
      setActive(0);
    };
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  }, [open]);

  function fire(command: Command) {
    setOpen(false);
    command.run();
  }

  return (
    <Portal>
      {/* THE WRAP IS THE PERMANENT HOOK, ITS CONTENT IS NOT. `#cmdkWrap` stays
          in the document with `show` as its open state (that is the element the
          acceptance probes hold a reference to before they open anything); the
          field itself mounts with the palette, which is both what replays the
          rise and the row cascade on every open and what keeps a second,
          invisible dialog out of the accessibility tree. */}
      <div
        className={`cmdk-wrap${open ? " show" : ""}`}
        id="cmdkWrap"
        onClick={() => setOpen(false)}
        role="presentation"
      >
        {open && (
        <div
          className="cmdk eg-glass eg-glass-panel"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Search clients, actions, records"
        >
          <div className="inrow">
            {/* Rule 46, the mark census: a SEARCH glyph here, never the > mark. */}
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              aria-hidden="true"
              style={{ stroke: "var(--ink-faint)", fill: "none", strokeWidth: 1.5, strokeLinecap: "round" }}
            >
              <circle cx="7" cy="7" r="4.6" />
              <path d="M10.5 10.5 14 14" />
            </svg>
            <input
              ref={inputRef}
              id="cmdkInput"
              placeholder="Search clients, actions, records…"
              aria-label="Search clients, actions, records"
            />
          </div>
          <div className="res">
            {commands.map((c, i) => {
              const index = visible.indexOf(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`r${index === -1 ? " hid" : ""}${index === active ? " sel" : ""}`}
                  style={{ "--i": i } as CSSProperties}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => fire(c)}
                >
                  {c.label}
                  <span className="act">{c.kind}</span>
                </button>
              );
            })}
            <div className={`nores${visible.length ? "" : " on"}`} id="cmdkNores">
              {/* THREE DIFFERENT FACTS, AND THEY ARE NOT THE SAME SENTENCE: the
                  org is still being asked, the org was asked and said nothing,
                  or the org could not be asked at all. */}
              {searchState === "running"
                ? "Searching the book\u2026"
                : searchState === "failed"
                  ? "The book could not be searched just now. The staged clients are still here."
                  : mcpAvailable() && query.trim().length >= MIN_QUERY
                    ? "No client of that name, here or in the book."
                    : "Nothing matches. Try a client or an action."}
            </div>
          </div>
        </div>
        )}
      </div>
    </Portal>
  );
}
