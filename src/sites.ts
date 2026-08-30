export type SiteBehavior = {
  name: "greenhouse" | "lever" | "ashby" | "workday" | "workable" | "generic";
  matches(url: string): boolean;
  submitSignals: RegExp[];
};

const known: SiteBehavior[] = [
  { name: "greenhouse", matches: (url) => /greenhouse\.io|boards\.greenhouse/i.test(url), submitSignals: [/thank you for applying/i, /application received/i, /thank you/i] },
  { name: "lever", matches: (url) => /jobs\.lever\.co|lever\.co/i.test(url), submitSignals: [/application submitted/i, /thanks for applying/i, /application received/i, /thank you/i] },
  { name: "ashby", matches: (url) => /ashbyhq\.com/i.test(url), submitSignals: [/application submitted/i, /thank you/i] },
  { name: "workday", matches: (url) => /myworkdayjobs\.com|workday/i.test(url), submitSignals: [/application submitted/i, /thank you/i] },
  { name: "workable", matches: (url) => /apply\.workable\.com|workable\.com/i.test(url), submitSignals: [/application (has been )?(submitted|received)/i, /thank you/i, /successfully/i] },
];

const generic: SiteBehavior = { name: "generic", matches: () => true, submitSignals: [/application submitted/i, /application received/i, /thank you/i] };

export function siteBehavior(url: string): SiteBehavior {
  return known.find((behavior) => behavior.matches(url)) ?? generic;
}
