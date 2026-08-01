#!/usr/bin/env node

/**
 * Verification script to check if the package is ready for publishing
 * Run this before publishing to catch common issues
 */

const fs = require('fs');
const path = require('path');

const errors = [];
const warnings = [];
const success = [];

console.log('🔍 Verifying Warpspace package...\n');

// Check 1: package.json exists and is valid
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  success.push(`✅ package.json is valid (v${pkg.version})`);
  
  // Check activation events
  if (!pkg.activationEvents || pkg.activationEvents.length === 0) {
    errors.push('❌ No activation events defined - extension won\'t activate!');
  } else if (pkg.activationEvents.includes('onView:worksnap.sidebarView')) {
    success.push('✅ Activation events include sidebar view');
  } else {
    warnings.push('⚠️  Missing onView:worksnap.sidebarView activation event');
  }
  
  // Check main entry point
  if (pkg.main !== './dist/extension.js') {
    errors.push(`❌ Main entry point should be ./dist/extension.js, got ${pkg.main}`);
  } else {
    success.push('✅ Main entry point is correct');
  }
} catch (e) {
  errors.push('❌ package.json is invalid or missing');
}

// Check 2: Compiled extension exists
if (fs.existsSync('dist/extension.js')) {
  success.push('✅ Compiled extension exists (dist/extension.js)');
} else {
  errors.push('❌ dist/extension.js not found - run npm run compile');
}

// Check 3: Icon files exist
if (fs.existsSync('media/icon.svg')) {
  const iconContent = fs.readFileSync('media/icon.svg', 'utf8');
  
  // Check if icon is monochrome
  if (iconContent.includes('currentColor')) {
    success.push('✅ Activity bar icon uses currentColor (monochrome)');
  } else if (iconContent.includes('stroke="#') || iconContent.includes('fill="#')) {
    errors.push('❌ Activity bar icon has colors - must be monochrome with currentColor');
  }
  
  // Check viewBox
  if (iconContent.includes('viewBox="0 0 16 16"')) {
    success.push('✅ Icon viewBox is 16x16 (standard size)');
  } else {
    warnings.push('⚠️  Icon viewBox should be "0 0 16 16" for best results');
  }
} else {
  errors.push('❌ media/icon.svg not found');
}

// Check 4: Codicons dependency
if (fs.existsSync('node_modules/@vscode/codicons')) {
  success.push('✅ Codicons dependency installed');
} else {
  errors.push('❌ @vscode/codicons not installed - run npm install');
}

// Check 5: .vscodeignore includes codicons exception
if (fs.existsSync('.vscodeignore')) {
  const vscodeignore = fs.readFileSync('.vscodeignore', 'utf8');
  
  // The webview loads codicon.css, which in turn requests codicon.ttf.
  // Both must survive the node_modules/** ignore or icons break in production.
  const hasCss = vscodeignore.includes('!node_modules/@vscode/codicons/dist/codicon.css')
    || vscodeignore.includes('!node_modules/@vscode/codicons/**');
  const hasFont = vscodeignore.includes('!node_modules/@vscode/codicons/dist/codicon.ttf')
    || vscodeignore.includes('!node_modules/@vscode/codicons/**');

  if (hasCss && hasFont) {
    success.push('✅ .vscodeignore keeps codicon.css and codicon.ttf');
  } else {
    errors.push('❌ .vscodeignore missing codicons exception - icons won\'t work in production!');
  }
} else {
  warnings.push('⚠️  .vscodeignore not found');
}

// Check 6: README exists and has content
if (fs.existsSync('README.md')) {
  const readme = fs.readFileSync('README.md', 'utf8');
  if (readme.length > 500) {
    success.push('✅ README.md exists and has content');
  } else {
    warnings.push('⚠️  README.md seems too short');
  }
} else {
  errors.push('❌ README.md not found');
}

// Check 7: CHANGELOG exists
if (fs.existsSync('CHANGELOG.md')) {
  success.push('✅ CHANGELOG.md exists');
} else {
  warnings.push('⚠️  CHANGELOG.md not found');
}

// Check 8: License exists
if (fs.existsSync('LICENSE')) {
  success.push('✅ LICENSE file exists');
} else {
  warnings.push('⚠️  LICENSE file not found');
}

// Print results
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (success.length > 0) {
  console.log('✅ PASSED:\n');
  success.forEach(msg => console.log(`  ${msg}`));
  console.log('');
}

if (warnings.length > 0) {
  console.log('⚠️  WARNINGS:\n');
  warnings.forEach(msg => console.log(`  ${msg}`));
  console.log('');
}

if (errors.length > 0) {
  console.log('❌ ERRORS:\n');
  errors.forEach(msg => console.log(`  ${msg}`));
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (errors.length > 0) {
  console.log('❌ VERIFICATION FAILED - Fix errors before publishing!\n');
  process.exit(1);
} else if (warnings.length > 0) {
  console.log('⚠️  VERIFICATION PASSED WITH WARNINGS\n');
  console.log('You can publish, but consider fixing warnings.\n');
  process.exit(0);
} else {
  console.log('✅ ALL CHECKS PASSED - Ready to publish!\n');
  console.log('Next steps:');
  console.log('  1. npm run package');
  console.log('  2. Test the .vsix file locally');
  console.log('  3. vsce publish\n');
  process.exit(0);
}

