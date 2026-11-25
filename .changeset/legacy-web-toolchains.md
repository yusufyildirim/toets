---
'@toets/sdk': patch
'@toets/sdk-react-native': patch
---

`@toets/sdk-react-native` builds when the bundler fails on missing imports (webpack's `strictExportPresence`, set by Create React App), supports react-native-web 0.18 and later with React 18 and later, and makes `react-native` an optional peer dependency for web-only apps. Docs: aliasing the packages on bundlers without `exports` support (webpack 4).
