const { withXcodeProject, IOSConfig } = require('expo/config-plugins');

/**
 * Links Apple's PencilKit.framework into the main iOS app target.
 *
 * react-native-pencil-kit@1.2.3's RNPencilKit.podspec does not declare
 * `s.frameworks = 'PencilKit'`, so its libRNPencilKit.a references PK*
 * symbols (PKCanvasView, PKInkType*, PKToolPicker, ...) that go
 * unresolved at archive time. Build 57 surfaced this after the previous
 * local GraphitePencilKit.podspec (which did declare the framework)
 * was disabled via `platforms: []`.
 */
const withPencilKitFramework = (config) => {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project,
      projectName: mod.modRequest.projectName,
    });

    const frameworksPhase = project.pbxFrameworksBuildPhaseObj(target.uuid);
    const alreadyLinked = frameworksPhase.files.some(
      (f) => typeof f.comment === 'string' && f.comment.includes('PencilKit.framework'),
    );

    if (!alreadyLinked) {
      project.addFramework('PencilKit.framework', {
        target: target.uuid,
        customFramework: false,
        embed: false,
        sign: false,
      });
    }

    return mod;
  });
};

module.exports = withPencilKitFramework;
