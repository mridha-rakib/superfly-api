const fs = require("node:fs");
const path = require("node:path");

// Function to create a module
function createModule(moduleName) {
  // Define paths - removed /app from the path
  const modulePath = path.join(__dirname, "src", "modules", moduleName);

  // Check if the module already exists
  if (fs.existsSync(modulePath)) {
    console.error(`Module "${moduleName}" already exists.`);
    return;
  }

  // Create the module folder
  fs.mkdirSync(modulePath, { recursive: true });

  // Define file names only (no content)
  const files = [
    `${moduleName}.type.ts`,
    `${moduleName}.interface.ts`,
    `${moduleName}.controller.ts`,
    `${moduleName}.route.ts`,
    `${moduleName}.repository.ts`,
    `${moduleName}.service.ts`,
    `${moduleName}.model.ts`,
    `${moduleName}.schema.ts`,
    `${moduleName}.utils.ts`,
  ];

  // Create empty files
  files.forEach((fileName) => {
    const filePath = path.join(modulePath, fileName);
    fs.writeFileSync(filePath, ""); // Empty content
  });

  console.log(
    `Module "${moduleName}" has been created successfully with empty files.`,
  );
}

// Get the module name from the command line arguments
const moduleName = process.argv[2];
if (!moduleName) {
  console.error("Please provide a module name.");
  process.exit(1);
}

// Create the module
createModule(moduleName);
