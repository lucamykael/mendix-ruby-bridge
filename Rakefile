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
