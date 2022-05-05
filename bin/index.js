#!/usr/bin/env node
import { Spinner } from "cli-spinner";
import fs from "fs";
import chalk from "chalk";
import process from "process";
import path from "path";
import decompress from "decompress";
import inquirer from "inquirer";
import { execSync, exec, spawn } from "child_process";

const error = chalk.bold.red.bgBlack("ERORR");
const warning = chalk.bold.yellow("WARNING");
const stdout = chalk.bgBlack("stdout");
const stderr = chalk.bgBlack("stderr");
const basename = path.basename(process.cwd());
const AppDir = path.join(process.cwd(), `${basename}.AppDir`);

const configPath = path.join(process.cwd(), "neutralino.config.json");
const configJson = await import(configPath, {
  assert: { type: "json" },
});

if (!configJson) {
  console.log(`${error}: This is not a neutralino app`);
  process.exit(1);
}

const spinner = new Spinner("Creating AppDir");
spinner.setSpinnerString(18);
spinner.start();

const handleAppDirSubdirErr = (err) => {
  if (err) {
    fs.rmdir(AppDir, (err) => {
      if (err) {
        spinner.stop();
        console.log(`${error} ${err.message}`);
        console.log(
          `${warning}: Some items were not deleted, please delete AppDir and all it's subdirectories`
        );
        process.exit(1);
      }
    });
  }
};

const createAppDir = () => {
  try {
    fs.mkdirSync(AppDir);
    fs.mkdirSync(path.join(AppDir, "usr"));
  } catch (err) {
    handleAppDirSubdirErr(err);
  }

  configureAppDir();
};

const configureAppDir = async () => {
  spinner.setSpinnerTitle(`extracting ${basename}-release.zip`);
  await decompress(
    path.join(process.cwd(), "dist", `${basename}-release.zip`),
    path.join(AppDir, "usr", "bin"),
    {
      filter: (file) =>
        path.extname(file.path) !== ".exe" &&
        file.path !== `${basename}-mac_x64`,
    }
  ).catch((err) => handleAppDirSubdirErr(err));

  spinner.setSpinnerTitle("configuring AppDir");
  const { icon } = configJson.default;

  if (icon) {
    try {
      const copyIcon = execSync(`cp ${icon} ${AppDir}`);
      if (copyIcon) {
        console.log(`${stdout} ${copyIcon.toString("utf8")}`);
      }
    } catch (err) {
      console.log(`${error}: ${err.message}`);
    }
  } else {
    console.log(`${warning} no icon included a default Icon will be used`);
    process.exit(1);
  }

  buildDesktopFile(icon);
};

const buildDesktopFile = (icon) => {
  const desktopFile = {
    Name: basename,
    Exec: `${basename}-linux_x64`,
    Icon: icon ? path.basename(icon, path.extname(icon)) : null,
    Type: "Application",
    Categories: "Utility",
  };

  try {
    fs.writeFileSync(
      path.join(AppDir, `${basename}.desktop`),
      "[Desktop Entry]" +
        `${Object.keys(desktopFile)
          .map((key) => "\n" + key + "=" + desktopFile[key])
          .join("")}`
    );
  } catch (err) {
    handleAppDirSubdirErr(err);
  }

  try {
    const exeDesktop = execSync(
      `chmod +x ${path.join(AppDir, basename)}.desktop`
    );
    process.stdout.write(exeDesktop.toString("utf8"));
    buildAppRun();
  } catch (err) {
    console.log(`${error}: ${err.message}`);
  }
};

const buildAppRun = () => {
  const EXEC = "${HERE}" + `/usr/bin/${basename}-linux_x64`;
  const Exec = "${EXEC}";

  const AppRun = {
    SELF: `$(readlink -f "$0")`,
    HERE: "${SELF%/*}",
    EXEC: `"${EXEC}"`,
  };

  try {
    fs.writeFileSync(
      path.join(AppDir, "AppRun"),
      `#!/bin/sh ${Object.keys(AppRun)
        .map((key) => "\n" + key + "=" + AppRun[key])
        .join("")} exec "${Exec}"`
    );
  } catch (err) {
    handleAppDirSubdirErr(err);
  }

  try {
    const exeAppRun = execSync(`chmod +x ${path.join(AppDir, "AppRun")}`);
    process.stdout.write(exeAppRun.toString("utf-8"));
    getLinuxDeploy();
  } catch (err) {
    console.log(`${error}: ${err.message}`);
  }
};

const getLinuxDeploy = () => {
  const chmodLinuxDeploy = () => {
    try {
      const exeLinuxDeploy = execSync(
        `chmod +x ${path.join(process.cwd(), "linuxdeploy-x86_64.AppImage")}`
      );
      if (exeLinuxDeploy) {
        console.log(`${stdout} ${exeLinuxDeploy.toString("utf8")}`);
      }
      buildAppImage();
    } catch (err) {
      console.log(`${error}: ${err.message}`);
    }
  };

  if (!fs.existsSync(path.join(process.cwd(), "linuxdeploy-x86_64.AppImage"))) {
    spinner.setSpinnerTitle("Downloading linuxdeploy-x86_64.AppImage");

    const child = spawn("wget", [
      "-nv",
      "https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage",
    ]);

    child.stderr.on("data", (data) => {
      if (data.length > 20) console.log(`${stderr} ${data}`);
    });
    child.stdout.on("data", (data) => console.log(`${stdout} ${data}`));
    child.on("error", (err) => {
      handleAppDirSubdirErr(err);
    });
    child.on("exit", () => chmodLinuxDeploy());
  } else {
    chmodLinuxDeploy();
  }
};

const buildAppImage = () => {
  spinner.setSpinnerTitle("Building AppImage");
  spinner.start();
  const configureAndBuild = (arch) => {
    try {
      const setARCH = execSync(`ARCH=${arch}`);
      if (setARCH) {
        console.log(`${stdout} ${setARCH.toString("utf8")}`);
      }
    } catch (err) {
      console.log(`${error}: ${err.message}`);
      process.exit(1);
    }

    spinner.stop(true);
    const child = spawn(
      "./linuxdeploy-x86_64.AppImage",

      ["--appdir", `${AppDir}`, "--output", "appimage"]
    );

    child.stderr.on("data", (data) => console.log(`${data}`));
    child.stdout.on("data", (data) => console.log(`${stdout} ${data}`));
    child.on("error", (err) => {
      handleAppDirSubdirErr(err);
    });
    child.on("exit", (code) => {
      deleteResources();
      if (code === 0) {
        console.log("Your AppImage has been built sucessfully!! 🚀");
      }
      process.exit();
    });
  };

  exec("uname -m", (error, stdout, stderr) => {
    if (error) {
      console.log(`${error}: ${error.message}`);
      return;
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`);
      return;
    }
    if (stdout) {
      const arch = stdout;
      configureAndBuild(arch);
    }
  });
};

const deleteResources = () => {
  const deleteArr = [
    AppDir,
    path.join(process.cwd(), "linuxdeploy-x86_64.AppImage"),
  ];

  deleteArr.forEach((item) =>
    fs.rmSync(item, { recursive: true, force: true })
  );
};

if (fs.existsSync(AppDir)) {
  inquirer
    .prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: `${AppDir} already exists! Would you like to replace it`,
        default: true,
      },
    ])
    .then((answers) => {
      if (answers.overwrite) createAppDir();
      else {
        console.log("closing...");
        process.exit(1);
      }
    });
} else {
  createAppDir();
}
