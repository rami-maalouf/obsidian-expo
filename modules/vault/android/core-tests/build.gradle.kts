plugins {
  // react native 0.88 builds the app's kotlin with 2.2.0.
  kotlin("jvm") version "2.2.0"
}

repositories {
  mavenCentral()
}

dependencies {
  testImplementation(kotlin("test-junit"))
}

kotlin {
  sourceSets {
    main {
      kotlin.srcDir("../src/main/java/expo/modules/vault/core")
    }
  }
}

tasks.test {
  // java decodes file names with the locale's charset; android always uses utf-8.
  environment("LC_ALL", "C.UTF-8")
  testLogging {
    events("failed")
    exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
  }
}
