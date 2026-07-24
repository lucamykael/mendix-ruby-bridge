require_relative "lib/mendix_bridge/version"

Gem::Specification.new do |spec|
  spec.name = "mendix-ruby-bridge"
  spec.version = MendixBridge::VERSION
  spec.summary = "Read, model, validate, and change Mendix projects with Ruby"
  spec.description =
    "A Ruby DSL and CLI for semantic Mendix inventories, guarded writes, " \
    "Git workflows, dependency analysis, migrations, and project creation."
  spec.authors = ["Mykael"]
  spec.license = "MIT"
  spec.homepage = "https://github.com/lucamykael/mendix-ruby-bridge"
  spec.metadata = {
    "source_code_uri" => spec.homepage,
    "changelog_uri" => "#{spec.homepage}/releases",
    "rubygems_mfa_required" => "true"
  }
  spec.files = Dir[
    "lib/**/*.rb",
    "bin/{mendix-ruby,mendix-git,git-mendix,mendix-apply}",
    "bin/{mxcli,setup-tools}",
    "web/dist/**/*",
    ".mxcli-version",
    "README.md",
    "LICENSE"
  ]
  spec.bindir = "bin"
  spec.executables = ["mendix-ruby", "mendix-git", "git-mendix", "mendix-apply"]
  spec.require_paths = ["lib"]
  spec.required_ruby_version = ">= 3.2"

  spec.add_development_dependency "minitest", ">= 5.0", "< 7.0"
  spec.add_development_dependency "rake", ">= 13.0", "< 14.0"
  spec.add_development_dependency "rspec", ">= 3.13", "< 4.0"
  spec.add_runtime_dependency "webrick", ">= 1.9", "< 2.0"
end
