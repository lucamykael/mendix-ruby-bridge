Gem::Specification.new do |spec|
  spec.name = "mendix-ruby-bridge"
  spec.version = "0.1.0"
  spec.summary = "Ruby DSL for describing Mendix application models"
  spec.authors = ["Mykael"]
  spec.files = Dir["lib/**/*.rb"]
  spec.bindir = "bin"
  spec.executables = ["mendix-ruby"]
  spec.require_paths = ["lib"]
  spec.required_ruby_version = ">= 3.2"

  spec.add_development_dependency "minitest", "~> 5.0"
end
