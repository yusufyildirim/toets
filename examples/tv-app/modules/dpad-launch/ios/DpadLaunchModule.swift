import ExpoModulesCore

/// Reads the dpad launch payload passed as the launch argument pair `-__dpad <JSON>`.
public class DpadLaunchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DpadLaunch")

    Function("getRawPayload") { () -> String? in
      let args = ProcessInfo.processInfo.arguments
      if let index = args.firstIndex(of: "-__dpad"), index + 1 < args.count {
        return args[index + 1]
      }
      // Launch arguments also land in the argument domain of the user defaults.
      return UserDefaults.standard.string(forKey: "__dpad")
    }
  }
}
