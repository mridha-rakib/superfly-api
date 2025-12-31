// tsconfig-paths-bootstrap.js
const tsConfigPaths = require("tsconfig-paths");
const tsConfig = require("./tsconfig.json");

const baseUrl = "./dist"; // Because compiled JS files live in dist/
tsConfigPaths.register({
  baseUrl,
  paths: tsConfig.compilerOptions.paths,
});
