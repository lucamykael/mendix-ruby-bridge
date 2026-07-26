# frozen_string_literal: true

require "bundler/gem_tasks"
require "rspec/core/rake_task"
require "rake/testtask"

Rake::TestTask.new do |task|
  task.pattern = "test/**/*_test.rb"
end

RSpec::Core::RakeTask.new(:spec)

task test: :spec
task default: :test

namespace :package do
  desc "Build .deb packages for Ubuntu/Debian (requires fpm: gem install fpm)"
  task :deb do
    sh "packaging/build-deb.sh"
  end

  desc "Build the PKGBUILD for Arch/Omarchy (run inside packaging/arch/)"
  task :arch do
    version = File.read("lib/mendix_bridge/version.rb")[/VERSION = "(.+)"/, 1]
    pkgbuild = File.read("packaging/arch/PKGBUILD")
    pkgbuild = pkgbuild.gsub(/^pkgver=.*/, "pkgver=#{version}")
    File.write("packaging/arch/PKGBUILD", pkgbuild)
    puts "Updated packaging/arch/PKGBUILD to version #{version}"
    puts "To build the Arch package, run:"
    puts "  cd packaging/arch && makepkg -si"
  end

  desc "Build all packages"
  task all: %i[deb arch]
end
