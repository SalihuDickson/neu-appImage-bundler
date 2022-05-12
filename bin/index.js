#!/usr/bin/env node
import { Spinner } from "cli-spinner";
import fs, { stat } from "fs";
import chalk from "chalk";
import process from "process";
import path from "path";
import decompress from "decompress";
import inquirer from "inquirer";
import { DownloaderHelper } from "node-downloader-helper";
import { execSync, exec, spawn } from "child_process";

const error = chalk.bold.red.bgBlack("ERORR");
const warning = chalk.bold.yellow("WARNING");
const stdout = chalk.bgBlack("stdout");
const basename = path.basename(process.cwd());
const AppDir = path.join(process.cwd(), `${basename}.AppDir`);
let configJson;

try {
  const configPath = path.join(process.cwd(), "neutralino.config.json");
  configJson = await import(configPath, {
    assert: { type: "json" },
  });
} catch (err) {
  console.log(
    `${error}: Cannot import "neutralino.config.json", "neu-appimage-bundler" only works in neutralinoJs apps`
  );
  process.exit(1);
}

const ARCH = execSync("uname -m");

const spinner = new Spinner("Creating AppDir");
spinner.setSpinnerString(18);

const handleAppDirSubdirErr = (err) => {
  if (err) {
    console.log(`${error} ${err.message}`);
    console.log("here");
    fs.rmSync(AppDir, { recursive: true, force: true });
    process.exit(1);
  }
};

const createAppDir = () => {
  spinner.start();
  try {
    fs.mkdirSync(AppDir);
    fs.mkdirSync(path.join(AppDir, "usr"));
  } catch (err) {
    handleAppDirSubdirErr(err);
  }

  spinner.stop(true);
  configureAppDir();
};

const configureAppDir = async () => {
  spinner.setSpinnerTitle(`extracting ${basename}-release.zip`);
  spinner.start();
  await decompress(
    path.join(process.cwd(), "dist", `${basename}-release.zip`),
    path.join(AppDir, "usr", "bin"),
    {
      filter: (file) =>
        file.path === `${basename}-linux_x64` || file.path === "resources.neu",
    }
  )
    .catch((err) => handleAppDirSubdirErr(err))
    .finally(() => spinner.stop(true));

  spinner.setSpinnerTitle("configuring AppDir");
  spinner.start();

  let icon;
  icon = configJson.default.icon;

  if (!icon) {
    spinner.stop(true);
    console.log(`${warning} no icon included a default Icon will be used`);
    spinner.start();

    icon = path.join(process.cwd(), "resources", "icons", "appIcon.png");
  }
  try {
    execSync(`cp ${icon} ${AppDir}`);
  } catch (err) {
    console.log(`${error}: ${err.message}`);
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
    console.log("here");
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
        .join("")} \nexec "${Exec}"`
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
  const chmodAppImage = () => {
    try {
      const exeLinuxDeploy = execSync(
        `chmod +x ${path.join(process.cwd(), "appimagetool-x86_64.AppImage")}`
      );
      if (exeLinuxDeploy) {
        console.log(`${stdout} ${exeLinuxDeploy.toString("utf8")}`);
      }
      buildAppImage();
    } catch (err) {
      console.log(`${error}: ${err.message}`);
    }
  };

  if (
    !fs.existsSync(path.join(process.cwd(), "appimagetool-x86_64.AppImage"))
  ) {
    const dl = new DownloaderHelper(
      "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage",
      process.cwd()
    );

    dl.start();
    dl.on("error", (err) => {
      handleAppDirSubdirErr(err);
    });
    dl.on("progress", ({ progress, speed }) => {
      spinner.stop(true);
      spinner.setSpinnerTitle(
        `Downloading appimagetool-x86_64.AppImage ${progress.toFixed(
          0
        )}% | ${speed}b/s`
      );
      spinner.start();
    });
    dl.on("end", () => {
      spinner.stop(true);
      chmodAppImage();
    });
  } else {
    chmodAppImage();
  }
};

const buildAppImage = () => {
  spinner.setSpinnerTitle("building AppImage");
  spinner.start();

  const child = spawn("./appimagetool-x86_64.AppImage", [`${AppDir}`], {
    env: { ARCH: ARCH },
  });

  child.on("spawn", () => spinner.stop(true));
  child.stderr.on("data", (data) => console.log(`${data}`));
  child.stdout.on("data", (data) => console.log(`${stdout} ${data}`));
  child.on("error", (err) => {
    handleAppDirSubdirErr(err);
  });
  child.on("exit", (code) => {
    deleteResources();
    if (code === 0) {
      console.log("Your AppImage has been built sucessfully!! 🚀");
      // console.log(
      //   `try "chmod +x ${basename}-${ARCH}.AppImage && ./${basename}-${ARCH}.AppImage" to check it out`
      // );
    }
    process.exit();
  });
};

const deleteResources = () => {
  const deleteArr = [
    AppDir,
    path.join(process.cwd(), "appimagetool-x86_64.AppImage"),
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
      if (answers.overwrite) {
        fs.rmSync(AppDir, { recursive: true, force: true });
        createAppDir();
      } else {
        console.log("closing...");
        process.exit(1);
      }
    });
} else {
  createAppDir();
}
