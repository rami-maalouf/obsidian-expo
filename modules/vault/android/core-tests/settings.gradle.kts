// the vault core is plain kotlin, built here so `gradle test` runs it on any jvm without the
// android sdk. the app compiles the same sources through ../build.gradle.
pluginManagement {
  repositories {
    gradlePluginPortal()
    mavenCentral()
  }
}

rootProject.name = "vault-core"
