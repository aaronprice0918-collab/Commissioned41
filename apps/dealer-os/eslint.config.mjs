// Next 16 removed `next lint` — ESLint 9 runs directly (`npm run lint`).
// eslint-config-next v16 ships native flat configs; this is the same
// next/core-web-vitals rule set the old .eslintrc.json extended.
import coreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...coreWebVitals,
  {
    // react-hooks v7 (new with Next 16) added compiler-derived rules that flag
    // long-standing, working patterns in this codebase. Keep them visible as
    // warnings — clean up over time — without failing the lint run.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  { ignores: [".next/**", "node_modules/**", "out/**", "public/**"] },
];

export default eslintConfig;
